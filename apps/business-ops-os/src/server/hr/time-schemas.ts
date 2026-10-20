/**
 * zod schemas for the HR time API (attendance, corrections, imports, shifts,
 * holidays, leave, timesheets). Routes validate with them; services take their
 * output types. Documented in docs/parts/hr-time.md.
 */
import { z } from 'zod';
import { isoDateSchema } from '@elevate/shared-contracts';

const text = (max = 500) => z.string().trim().max(max);
const optText = (max = 500) => text(max).nullish();
const hm = z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, { error: 'Use HH:MM (24 h).' });
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, { error: 'Use YYYY-MM.' });
const page = z.coerce.number().int().min(1).max(10_000).default(1);
const breakMinutes = z.int().min(0).max(1440);
const weekdays = z.array(z.int().min(0).max(6)).min(1).max(7);
const decisionStatus = z.enum(['proposed', 'approved', 'retired']);
const range = { from: isoDateSchema, to: isoDateSchema };
const optionalRange = { from: isoDateSchema.optional(), to: isoDateSchema.optional() };
/** Local date + times in the employee's timezone. */
const sessionTimes = {
  workDate: isoDateSchema,
  clockIn: hm,
  /** Date of the clock-out when it is not `workDate` (overnight). */
  clockOutDate: isoDateSchema.nullish(),
  breakMinutes: breakMinutes.default(0),
};

export const timeIdParams = z.object({ id: z.uuid() });

// --- attendance -------------------------------------------------------------------------------

export const attendanceListQuery = z.object({
  staffId: z.uuid().optional(),
  ...optionalRange,
  status: z.enum(['open', 'closed', 'superseded', 'missing_clock_out']).optional(),
  source: z.enum(['self', 'manual', 'csv_import', 'provider', 'correction']).optional(),
  page,
});
export type AttendanceListQuery = z.output<typeof attendanceListQuery>;

export const clockBody = z.object({ note: optText(500) });

export const breakBody = z.object({ action: z.enum(['start', 'end']) });

/** Manual entry: a reason is mandatory. */
export const manualSessionBody = z.object({
  staffId: z.uuid(),
  ...sessionTimes,
  clockOut: hm.nullish(),
  reason: text(1000).min(3, { error: 'A reason is required for a manual entry.' }),
});
export type ManualSessionInput = z.output<typeof manualSessionBody>;

export const summaryQuery = z.object({ staffId: z.uuid().optional(), month: month.optional() });

// --- corrections ------------------------------------------------------------------------------

export const correctionListQuery = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'withdrawn']).optional(),
  staffId: z.uuid().optional(),
  page,
});

export const createCorrectionBody = z.object({
  /** The session to correct; omit for a day with no session at all. */
  sessionId: z.uuid().nullish(),
  ...sessionTimes,
  clockOut: hm,
  reason: text(1000).min(3, { error: 'Explain what is wrong and why.' }),
});
export type CreateCorrectionInput = z.output<typeof createCorrectionBody>;

export const decisionBody = z.object({
  decision: z.enum(['approve', 'reject']),
  note: optText(1000),
});
export type DecisionInput = z.output<typeof decisionBody>;

// --- CSV import -------------------------------------------------------------------------------

export const importBody = z.object({
  csv: z.string().min(1).max(2_000_000),
  fileName: optText(200),
  /** false (default) = preview only; true = commit the valid rows. */
  commit: z.boolean().default(false),
});
export type ImportInput = z.output<typeof importBody>;

// --- shifts, assignments, holidays ------------------------------------------------------------

export const createShiftBody = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9][A-Z0-9_-]{1,23}$/, { error: '2–24 letters, digits, - or _.' }),
  name: text(120).min(1),
  startTime: hm,
  endTime: hm,
  crossesMidnight: z.boolean().default(false),
  unpaidBreakMinutes: z.int().min(0).max(600).default(0),
  workingWeekdays: weekdays,
  location: optText(120),
  departmentId: z.uuid().nullish(),
  notes: optText(1000),
});
export type CreateShiftInput = z.output<typeof createShiftBody>;

export const updateShiftBody = createShiftBody
  .omit({ code: true })
  .extend({
    crossesMidnight: z.boolean(),
    unpaidBreakMinutes: z.int().min(0).max(600),
    status: decisionStatus,
  })
  .partial();
export type UpdateShiftInput = z.output<typeof updateShiftBody>;

export const assignmentListQuery = z.object({
  staffId: z.uuid().optional(),
  shiftTemplateId: z.uuid().optional(),
  includeCancelled: z.enum(['true', 'false']).optional(),
  page,
});

export const createAssignmentBody = z.object({
  staffId: z.uuid(),
  shiftTemplateId: z.uuid(),
  fromDate: isoDateSchema,
  toDate: isoDateSchema.nullish(),
  note: optText(500),
});
export type CreateAssignmentInput = z.output<typeof createAssignmentBody>;

export const updateAssignmentBody = z.union([
  z.object({ action: z.literal('end'), toDate: isoDateSchema }),
  z.object({ action: z.literal('cancel'), reason: text(500).min(3) }),
]);
export type UpdateAssignmentInput = z.output<typeof updateAssignmentBody>;

export const holidayListQuery = z.object({
  ...optionalRange,
  includeWithdrawn: z.enum(['true', 'false']).optional(),
});

export const createHolidayBody = z.object({
  holidayDate: isoDateSchema,
  name: text(120).min(1),
  location: optText(120),
  note: optText(500),
});
export type CreateHolidayInput = z.output<typeof createHolidayBody>;

export const updateHolidayBody = z.object({
  status: z.enum(['proposed', 'approved', 'withdrawn']),
  note: optText(500),
});

// --- leave ------------------------------------------------------------------------------------

export const createLeaveTypeBody = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z][A-Z0-9_]{1,15}$/, { error: '2–16 capital letters, digits or _.' }),
  name: text(120).min(1),
  paid: z.boolean(),
  halfDayAllowed: z.boolean().default(true),
  requiresDocument: z.boolean().default(false),
  description: optText(1000),
});
export type CreateLeaveTypeInput = z.output<typeof createLeaveTypeBody>;

export const updateLeaveTypeBody = createLeaveTypeBody
  .omit({ code: true })
  .extend({ halfDayAllowed: z.boolean(), requiresDocument: z.boolean(), status: decisionStatus })
  .partial();
export type UpdateLeaveTypeInput = z.output<typeof updateLeaveTypeBody>;

const part = z.enum(['full', 'first_half', 'second_half']);

export const leaveListQuery = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'cancelled']).optional(),
  staffId: z.uuid().optional(),
  ...optionalRange,
  view: z.enum(['mine', 'to_decide', 'all']).optional(),
  page,
});
export type LeaveListQuery = z.output<typeof leaveListQuery>;

export const createLeaveBody = z.object({
  /** Defaults to the requester. Requesting for someone else needs `ops:leave:request` with scope all. */
  staffId: z.uuid().nullish(),
  leaveTypeId: z.uuid(),
  startDate: isoDateSchema,
  endDate: isoDateSchema,
  startPart: part.default('full'),
  endPart: part.nullish(),
  reason: optText(1000),
  documentRef: optText(300),
});
export type CreateLeaveInput = z.output<typeof createLeaveBody>;

export const cancelLeaveBody = z.object({ reason: optText(1000) });

export const availabilityQuery = z.object({
  ...range,
  departmentId: z.uuid().optional(),
});

export const balanceQuery = z.object({ staffId: z.uuid().optional() });

export const ledgerEntryBody = z.object({
  staffId: z.uuid(),
  leaveTypeId: z.uuid(),
  entryType: z.enum(['allocation', 'adjustment']),
  days: z
    .number()
    .min(-366)
    .max(366)
    .refine((n) => Number.isInteger(n * 2), { error: 'Use steps of 0.5 days.' }),
  effectiveDate: isoDateSchema,
  periodLabel: optText(60),
  note: text(500).min(3, { error: 'Say why (e.g. "allocation recorded by HR").' }),
});
export type LedgerEntryInput = z.output<typeof ledgerEntryBody>;

// --- timesheets -------------------------------------------------------------------------------

export const timesheetQuery = z.object({
  ...range,
  staffId: z.uuid().optional(),
  departmentId: z.uuid().optional(),
});
export type TimesheetQuery = z.output<typeof timesheetQuery>;

export const ledgerQuery = z.object({ staffId: z.uuid() });

export const leaveTypeListQuery = z.object({
  includeRetired: z.enum(['true', 'false']).optional(),
});

export const importListQuery = z.object({ page });
