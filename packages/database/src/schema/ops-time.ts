/**
 * OWNER: Business Ops OS team — HR time slice (OPS-050…OPS-059, D-028).
 *
 * STAFF attendance sessions (with breaks, corrections and CSV import batches),
 * shift templates and assignments, the company holiday calendar, leave types,
 * leave requests and the leave balance ledger. This is staff time only: Academic
 * OS class/student attendance is never stored or duplicated here.
 *
 * Rules: same as ops.ts — `ops.table(...)` (import `ops` from './ops'), exports
 * prefixed `ops`, UUID PKs, human codes in separate unique columns, FKs only
 * into `ops` or `core`, column helpers from './ops-columns', only
 * `import type` from workspace packages, no `drizzle-kit generate`.
 *
 * History rules: attendance rows are never overwritten by a correction — the
 * original row is marked `superseded` and a new row carries the corrected
 * values (`correction_id`). Leave balances are a ledger (rows are only added).
 * Every attendance/leave/shift policy is configuration with a decision state
 * (apps/business-ops-os/src/domain/policies.ts, OD-026).
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  text,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import type { Brand, DepartmentId } from '@elevate/shared-types';
import { departments } from './core';
import { ops } from './ops';
import {
  createdAt,
  inList,
  instant,
  isoDate,
  staffRefRestrict,
  updatedAt,
  userRef,
} from './ops-columns';

export type OpsShiftTemplateId = Brand<string, 'OpsShiftTemplateId'>;
export type OpsShiftAssignmentId = Brand<string, 'OpsShiftAssignmentId'>;
export type OpsHolidayId = Brand<string, 'OpsHolidayId'>;
export type OpsAttendanceSessionId = Brand<string, 'OpsAttendanceSessionId'>;
export type OpsAttendanceBreakId = Brand<string, 'OpsAttendanceBreakId'>;
export type OpsAttendanceCorrectionId = Brand<string, 'OpsAttendanceCorrectionId'>;
export type OpsAttendanceImportId = Brand<string, 'OpsAttendanceImportId'>;
export type OpsLeaveTypeId = Brand<string, 'OpsLeaveTypeId'>;
export type OpsLeaveRequestId = Brand<string, 'OpsLeaveRequestId'>;
export type OpsLeaveLedgerEntryId = Brand<string, 'OpsLeaveLedgerEntryId'>;

/** Policy-like rows carry a decision state: the owner decides actual timings, types and holidays. */
export const OPS_TIME_DECISION_STATES = ['proposed', 'approved', 'retired'] as const;
export const OPS_HOLIDAY_STATES = ['proposed', 'approved', 'withdrawn'] as const;
export const OPS_SHIFT_ASSIGNMENT_STATUSES = ['active', 'cancelled'] as const;
export const OPS_ATTENDANCE_SOURCES = [
  'self',
  'manual',
  'csv_import',
  'provider',
  'correction',
] as const;
export const OPS_ATTENDANCE_STATUSES = ['open', 'closed', 'superseded'] as const;
export const OPS_CORRECTION_STATUSES = ['pending', 'approved', 'rejected', 'withdrawn'] as const;
export const OPS_LEAVE_STATUSES = ['pending', 'approved', 'rejected', 'cancelled'] as const;
export const OPS_LEAVE_PARTS = ['full', 'first_half', 'second_half'] as const;
export const OPS_LEAVE_LEDGER_TYPES = ['allocation', 'adjustment', 'usage', 'reversal'] as const;

/**
 * Shift template: local start/end time (in the employee's timezone), unpaid
 * break and working weekdays (0 = Sunday … 6 = Saturday). Timings are an owner
 * decision, so templates start `proposed`. Never deleted (`retired`).
 */
export const opsShiftTemplates = ops.table(
  'shift_templates',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<OpsShiftTemplateId>(),
    /** Short unique code, e.g. GEN-DAY. */
    code: text('code').notNull(),
    name: text('name').notNull(),
    /** Local wall-clock `HH:MM`. */
    startTime: text('start_time').notNull(),
    endTime: text('end_time').notNull(),
    crossesMidnight: boolean('crosses_midnight').notNull().default(false),
    unpaidBreakMinutes: integer('unpaid_break_minutes').notNull().default(0),
    workingWeekdays: jsonb('working_weekdays').$type<number[]>().notNull(),
    location: text('location'),
    departmentId: uuid('department_id')
      .references(() => departments.id, { onDelete: 'set null' })
      .$type<DepartmentId>(),
    status: text('status', { enum: OPS_TIME_DECISION_STATES }).notNull().default('proposed'),
    notes: text('notes'),
    createdBy: userRef('created_by').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('shift_templates_code_key').on(t.code),
    check('shift_templates_code_format', sql`${t.code} ~ '^[A-Z0-9][A-Z0-9_-]{1,23}$'`),
    check('shift_templates_start_format', sql`${t.startTime} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`),
    check('shift_templates_end_format', sql`${t.endTime} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`),
    check(
      'shift_templates_midnight_consistent',
      sql`(${t.crossesMidnight} AND ${t.endTime} <= ${t.startTime}) OR (NOT ${t.crossesMidnight} AND ${t.endTime} > ${t.startTime})`,
    ),
    check('shift_templates_break_range', sql`${t.unpaidBreakMinutes} BETWEEN 0 AND 600`),
    check('shift_templates_status_check', sql`${t.status} IN ${inList(OPS_TIME_DECISION_STATES)}`),
  ],
);

/**
 * Which shift an employee works from `from_date` to `to_date` (inclusive; null
 * = open-ended). Overlaps are refused by the service unless the split-shift
 * policy allows them. Cancelled rows stay for history.
 */
export const opsShiftAssignments = ops.table(
  'shift_assignments',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<OpsShiftAssignmentId>(),
    staffId: staffRefRestrict('staff_id').notNull(),
    shiftTemplateId: uuid('shift_template_id')
      .notNull()
      .references(() => opsShiftTemplates.id, { onDelete: 'restrict' })
      .$type<OpsShiftTemplateId>(),
    fromDate: isoDate('from_date').notNull(),
    toDate: isoDate('to_date'),
    status: text('status', { enum: OPS_SHIFT_ASSIGNMENT_STATUSES }).notNull().default('active'),
    note: text('note'),
    cancelReason: text('cancel_reason'),
    createdBy: userRef('created_by').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('shift_assignments_staff_idx').on(t.staffId, t.fromDate),
    check(
      'shift_assignments_dates_order',
      sql`${t.toDate} IS NULL OR ${t.toDate} >= ${t.fromDate}`,
    ),
    check(
      'shift_assignments_status_check',
      sql`${t.status} IN ${inList(OPS_SHIFT_ASSIGNMENT_STATUSES)}`,
    ),
  ],
);

/**
 * Company holiday calendar (separate from Academic OS's teaching calendar,
 * OD-018). `location` null = every location; otherwise matched against the
 * employee's work location. The calendar itself is an owner decision.
 */
export const opsHolidays = ops.table(
  'holidays',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<OpsHolidayId>(),
    holidayDate: isoDate('holiday_date').notNull(),
    name: text('name').notNull(),
    location: text('location'),
    status: text('status', { enum: OPS_HOLIDAY_STATES }).notNull().default('proposed'),
    note: text('note'),
    createdBy: userRef('created_by').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('holidays_date_location_key')
      .on(t.holidayDate, sql`coalesce(lower(${t.location}), '')`)
      .where(sql`${t.status} <> 'withdrawn'`),
    check('holidays_status_check', sql`${t.status} IN ${inList(OPS_HOLIDAY_STATES)}`),
  ],
);

/** CSV import batch: one row per committed file (sha256 of the content is unique → idempotent). */
export const opsAttendanceImports = ops.table(
  'attendance_imports',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<OpsAttendanceImportId>(),
    fileSha256: text('file_sha256').notNull(),
    fileName: text('file_name'),
    totalRows: integer('total_rows').notNull(),
    validRows: integer('valid_rows').notNull(),
    invalidRows: integer('invalid_rows').notNull(),
    createdSessions: integer('created_sessions').notNull(),
    /** Per-row errors of the rows that were not imported: [{ row, errors[] }]. */
    rowErrors: jsonb('row_errors').$type<{ row: number; errors: string[] }[]>().notNull(),
    importedBy: userRef('imported_by').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('attendance_imports_sha_key').on(t.fileSha256),
    check('attendance_imports_sha_format', sql`${t.fileSha256} ~ '^[0-9a-f]{64}$'`),
    check(
      'attendance_imports_counts',
      sql`${t.validRows} + ${t.invalidRows} = ${t.totalRows} AND ${t.createdSessions} <= ${t.validRows}`,
    ),
  ],
);

/**
 * One clock-in → clock-out session of a staff member. `work_date` is the
 * calendar day of the clock-in in the employee's timezone (`timezone`).
 * `break_minutes` is the unpaid break total used in calculations.
 * Late/early minutes are measured against the assigned shift when the session
 * closes (null = no shift that day / not measured). A superseded row is kept
 * forever and points at the row that replaced it.
 */
export const opsAttendanceSessions = ops.table(
  'attendance_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<OpsAttendanceSessionId>(),
    staffId: staffRefRestrict('staff_id').notNull(),
    workDate: isoDate('work_date').notNull(),
    clockInAt: instant('clock_in_at').notNull(),
    clockOutAt: instant('clock_out_at'),
    timezone: text('timezone').notNull(),
    breakMinutes: integer('break_minutes').notNull().default(0),
    source: text('source', { enum: OPS_ATTENDANCE_SOURCES }).notNull(),
    status: text('status', { enum: OPS_ATTENDANCE_STATUSES }).notNull().default('open'),
    shiftTemplateId: uuid('shift_template_id')
      .references(() => opsShiftTemplates.id, { onDelete: 'restrict' })
      .$type<OpsShiftTemplateId>(),
    lateMinutes: integer('late_minutes'),
    earlyDepartureMinutes: integer('early_departure_minutes'),
    /** Set by the missing clock-out check; cleared when the session closes. */
    missingClockOutFlaggedAt: instant('missing_clock_out_flagged_at'),
    /** Mandatory for manual entries (who/why); also used for CSV notes. */
    reason: text('reason'),
    importId: uuid('import_id')
      .references(() => opsAttendanceImports.id, { onDelete: 'restrict' })
      .$type<OpsAttendanceImportId>(),
    /** Set on a row created by an approved correction. */
    correctionId: uuid('correction_id').$type<OpsAttendanceCorrectionId>(),
    supersededById: uuid('superseded_by_id')
      .references((): AnyPgColumn => opsAttendanceSessions.id, { onDelete: 'restrict' })
      .$type<OpsAttendanceSessionId>(),
    supersededAt: instant('superseded_at'),
    createdBy: userRef('created_by').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('attendance_sessions_staff_date_idx').on(t.staffId, t.workDate),
    index('attendance_sessions_status_idx').on(t.status),
    uniqueIndex('attendance_sessions_one_open_key')
      .on(t.staffId)
      .where(sql`${t.status} = 'open'`),
    check(
      'attendance_sessions_order',
      sql`${t.clockOutAt} IS NULL OR ${t.clockOutAt} > ${t.clockInAt}`,
    ),
    check(
      'attendance_sessions_open_consistent',
      sql`(${t.status} = 'open') = (${t.clockOutAt} IS NULL) OR ${t.status} = 'superseded'`,
    ),
    check(
      'attendance_sessions_superseded_consistent',
      sql`(${t.status} = 'superseded') = (${t.supersededAt} IS NOT NULL)`,
    ),
    check('attendance_sessions_break_range', sql`${t.breakMinutes} BETWEEN 0 AND 1440`),
    check(
      'attendance_sessions_source_check',
      sql`${t.source} IN ${inList(OPS_ATTENDANCE_SOURCES)}`,
    ),
    check(
      'attendance_sessions_status_check',
      sql`${t.status} IN ${inList(OPS_ATTENDANCE_STATUSES)}`,
    ),
    check(
      'attendance_sessions_manual_reason',
      sql`${t.source} <> 'manual' OR length(trim(coalesce(${t.reason}, ''))) > 0`,
    ),
  ],
);

/** Break records of a self-recorded session (start/end). */
export const opsAttendanceBreaks = ops.table(
  'attendance_breaks',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<OpsAttendanceBreakId>(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => opsAttendanceSessions.id, { onDelete: 'restrict' })
      .$type<OpsAttendanceSessionId>(),
    startAt: instant('start_at').notNull(),
    endAt: instant('end_at'),
    createdBy: userRef('created_by').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('attendance_breaks_session_idx').on(t.sessionId),
    uniqueIndex('attendance_breaks_one_open_key')
      .on(t.sessionId)
      .where(sql`${t.endAt} IS NULL`),
    check('attendance_breaks_order', sql`${t.endAt} IS NULL OR ${t.endAt} > ${t.startAt}`),
  ],
);

/**
 * Correction request (ATC-######): proposed times with a reason. Approval
 * supersedes the original session (kept) and creates a new session; rejection
 * keeps the original. `session_id` null = a missing day (no session existed).
 */
export const opsAttendanceCorrections = ops.table(
  'attendance_corrections',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<OpsAttendanceCorrectionId>(),
    code: text('code').notNull(),
    staffId: staffRefRestrict('staff_id').notNull(),
    sessionId: uuid('session_id')
      .references(() => opsAttendanceSessions.id, { onDelete: 'restrict' })
      .$type<OpsAttendanceSessionId>(),
    workDate: isoDate('work_date').notNull(),
    proposedClockInAt: instant('proposed_clock_in_at').notNull(),
    proposedClockOutAt: instant('proposed_clock_out_at').notNull(),
    proposedBreakMinutes: integer('proposed_break_minutes').notNull().default(0),
    reason: text('reason').notNull(),
    status: text('status', { enum: OPS_CORRECTION_STATUSES }).notNull().default('pending'),
    requestedBy: userRef('requested_by').notNull(),
    decidedBy: userRef('decided_by'),
    decidedAt: instant('decided_at'),
    decisionNote: text('decision_note'),
    resultingSessionId: uuid('resulting_session_id')
      .references(() => opsAttendanceSessions.id, { onDelete: 'restrict' })
      .$type<OpsAttendanceSessionId>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('attendance_corrections_code_key').on(t.code),
    uniqueIndex('attendance_corrections_one_pending_key')
      .on(t.sessionId)
      .where(sql`${t.status} = 'pending' AND ${t.sessionId} IS NOT NULL`),
    index('attendance_corrections_staff_idx').on(t.staffId, t.status),
    check('attendance_corrections_code_format', sql`${t.code} ~ '^ATC-[0-9]{6}$'`),
    check('attendance_corrections_order', sql`${t.proposedClockOutAt} > ${t.proposedClockInAt}`),
    check(
      'attendance_corrections_status_check',
      sql`${t.status} IN ${inList(OPS_CORRECTION_STATUSES)}`,
    ),
    check(
      'attendance_corrections_decided_consistent',
      sql`(${t.status} IN ('approved', 'rejected')) = (${t.decidedBy} IS NOT NULL)`,
    ),
    check(
      'attendance_corrections_result_consistent',
      sql`(${t.status} = 'approved') = (${t.resultingSessionId} IS NOT NULL)`,
    ),
  ],
);

/** Leave types. The company's actual leave types are an owner decision (OD-026): `proposed` until approved. */
export const opsLeaveTypes = ops.table(
  'leave_types',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<OpsLeaveTypeId>(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    paid: boolean('paid').notNull(),
    halfDayAllowed: boolean('half_day_allowed').notNull().default(true),
    requiresDocument: boolean('requires_document').notNull().default(false),
    description: text('description'),
    status: text('status', { enum: OPS_TIME_DECISION_STATES }).notNull().default('proposed'),
    createdBy: userRef('created_by').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('leave_types_code_key').on(t.code),
    check('leave_types_code_format', sql`${t.code} ~ '^[A-Z][A-Z0-9_]{1,15}$'`),
    check('leave_types_status_check', sql`${t.status} IN ${inList(OPS_TIME_DECISION_STATES)}`),
  ],
);

/**
 * Leave request (LVR-######). Half-day parts: on a single day start_part =
 * end_part; over several days start_part ∈ {full, second_half} and end_part ∈
 * {full, first_half}. `working_days` is the count at request time (holidays and
 * non-working days excluded).
 */
export const opsLeaveRequests = ops.table(
  'leave_requests',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<OpsLeaveRequestId>(),
    code: text('code').notNull(),
    staffId: staffRefRestrict('staff_id').notNull(),
    leaveTypeId: uuid('leave_type_id')
      .notNull()
      .references(() => opsLeaveTypes.id, { onDelete: 'restrict' })
      .$type<OpsLeaveTypeId>(),
    startDate: isoDate('start_date').notNull(),
    endDate: isoDate('end_date').notNull(),
    startPart: text('start_part', { enum: OPS_LEAVE_PARTS }).notNull().default('full'),
    endPart: text('end_part', { enum: OPS_LEAVE_PARTS }).notNull().default('full'),
    workingDays: numeric('working_days', { precision: 6, scale: 1 }).notNull(),
    reason: text('reason'),
    documentRef: text('document_ref'),
    status: text('status', { enum: OPS_LEAVE_STATUSES }).notNull().default('pending'),
    requestedBy: userRef('requested_by').notNull(),
    decidedBy: userRef('decided_by'),
    decidedAt: instant('decided_at'),
    decisionNote: text('decision_note'),
    cancelledBy: userRef('cancelled_by'),
    cancelledAt: instant('cancelled_at'),
    cancelReason: text('cancel_reason'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('leave_requests_code_key').on(t.code),
    index('leave_requests_staff_dates_idx').on(t.staffId, t.startDate, t.endDate),
    index('leave_requests_status_idx').on(t.status),
    check('leave_requests_code_format', sql`${t.code} ~ '^LVR-[0-9]{6}$'`),
    check('leave_requests_dates_order', sql`${t.endDate} >= ${t.startDate}`),
    check('leave_requests_status_check', sql`${t.status} IN ${inList(OPS_LEAVE_STATUSES)}`),
    check('leave_requests_start_part_check', sql`${t.startPart} IN ${inList(OPS_LEAVE_PARTS)}`),
    check('leave_requests_end_part_check', sql`${t.endPart} IN ${inList(OPS_LEAVE_PARTS)}`),
    check(
      'leave_requests_parts_consistent',
      sql`(${t.startDate} = ${t.endDate} AND ${t.startPart} = ${t.endPart}) OR (${t.startDate} < ${t.endDate} AND ${t.startPart} IN ('full', 'second_half') AND ${t.endPart} IN ('full', 'first_half'))`,
    ),
    check('leave_requests_days_nonneg', sql`${t.workingDays} >= 0`),
    check(
      'leave_requests_cancel_consistent',
      sql`(${t.status} = 'cancelled') = (${t.cancelledAt} IS NOT NULL)`,
    ),
  ],
);

/**
 * Leave balance ledger: allocation (+), adjustment (±), usage (−, from an
 * approved request), reversal (+, from a cancellation). Rows are never edited.
 * No allocation row for an employee + type = balance "not configured" (not 0).
 * Accrual, carry-forward and encashment are open policies: nothing writes them.
 */
export const opsLeaveLedgerEntries = ops.table(
  'leave_ledger_entries',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<OpsLeaveLedgerEntryId>(),
    staffId: staffRefRestrict('staff_id').notNull(),
    leaveTypeId: uuid('leave_type_id')
      .notNull()
      .references(() => opsLeaveTypes.id, { onDelete: 'restrict' })
      .$type<OpsLeaveTypeId>(),
    entryType: text('entry_type', { enum: OPS_LEAVE_LEDGER_TYPES }).notNull(),
    /** Signed day count in steps of 0.5. */
    days: numeric('days', { precision: 6, scale: 1 }).notNull(),
    /** Free label for the leave year/period (the leave year is an open policy). */
    periodLabel: text('period_label'),
    effectiveDate: isoDate('effective_date').notNull(),
    leaveRequestId: uuid('leave_request_id')
      .references(() => opsLeaveRequests.id, { onDelete: 'restrict' })
      .$type<OpsLeaveRequestId>(),
    note: text('note'),
    createdBy: userRef('created_by').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('leave_ledger_staff_type_idx').on(t.staffId, t.leaveTypeId),
    uniqueIndex('leave_ledger_request_entry_key')
      .on(t.leaveRequestId, t.entryType)
      .where(sql`${t.leaveRequestId} IS NOT NULL`),
    check('leave_ledger_type_check', sql`${t.entryType} IN ${inList(OPS_LEAVE_LEDGER_TYPES)}`),
    check(
      'leave_ledger_sign',
      sql`(${t.entryType} = 'usage' AND ${t.days} <= 0) OR (${t.entryType} IN ('allocation', 'reversal') AND ${t.days} >= 0) OR ${t.entryType} = 'adjustment'`,
    ),
    check(
      'leave_ledger_request_link',
      sql`${t.entryType} NOT IN ('usage', 'reversal') OR ${t.leaveRequestId} IS NOT NULL`,
    ),
  ],
);
