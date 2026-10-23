/** zod schemas for staff attendance (owner brief 23 Oct 2026 §12). */
import { z } from 'zod';
import { isoDateSchema } from '@elevate/shared-contracts';
import { OPS_WEEKDAYS } from '@elevate/database';
import {
  ATTENDANCE_STATUSES,
  MAX_PUNCH_CSV_CHARS,
  REQUESTABLE_STATUSES,
} from '../domain/attendance';

const text = (max: number) => z.string().trim().max(max);
const note = (max = 1000) => text(max).nullish();
/** A form's `YYYY-MM-DDTHH:MM` is IST; a full ISO instant keeps its offset. */
const instant = z.union([
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/)
    .transform((v) => new Date(`${v.slice(0, 16)}:00+05:30`)),
  z.iso.datetime({ offset: true }).transform((v) => new Date(v)),
]);
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a time like 09:30');

export const attendanceListQuery = z.object({
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  staffId: z.uuid().optional(),
  /** Staff name or code. */
  q: text(100).optional(),
  status: z.enum(ATTENDANCE_STATUSES).optional(),
  department: z.uuid().optional(),
  branch: z.uuid().optional(),
  /** Only days that need HR's attention (`1` = for any reason). */
  review: z.enum(['1', 'unmarked', 'missing_checkout']).optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
});
export type AttendanceListQuery = z.input<typeof attendanceListQuery>;

export const punchBody = z.object({
  staffId: z.uuid(),
  at: instant,
  direction: z.enum(['in', 'out']),
  note: note(300),
});

export const decisionBody = z.object({
  staffId: z.uuid(),
  workDate: isoDateSchema,
  status: z.enum(ATTENDANCE_STATUSES),
  note: text(1000).min(3, 'Say why (at least 3 characters)'),
});

export const leaveBody = z
  .object({
    staffId: z.uuid(),
    fromDate: isoDateSchema,
    toDate: isoDateSchema,
    kind: text(80).min(1, 'Required'),
    reason: note(),
  })
  .refine((b) => b.toDate >= b.fromDate, {
    path: ['toDate'],
    message: 'The last day cannot be before the first day',
  });

export const cancelLeaveBody = z.object({
  reason: text(1000).min(3, 'Say why the leave is cancelled'),
});
export const holidayDecisionBody = z.object({ action: z.enum(['approve', 'remove']) });

export const holidayBody = z.object({
  holidayOn: isoDateSchema,
  name: text(120).min(1, 'Required'),
  branchId: z.uuid().nullish(),
});

/** A weekday's hours; absent or null = weekly off. */
const day = z
  .object({ start: hhmm, end: hhmm })
  .nullish()
  .transform((d) => d ?? null)
  .refine((d) => !d || d.end > d.start, 'The end must be after the start');
export const scheduleBody = z.object({
  name: text(80).min(1, 'Required'),
  weeklyPattern: z.object(
    Object.fromEntries(OPS_WEEKDAYS.map((d) => [d, day])) as Record<
      (typeof OPS_WEEKDAYS)[number],
      typeof day
    >,
  ),
  graceMinutes: z.coerce.number().int().min(0).max(240).default(0),
  isDefault: z.boolean().default(false),
});

export const assignScheduleBody = z.object({
  staffId: z.uuid(),
  /** null or absent = follow the default schedule. */
  scheduleId: z
    .uuid()
    .nullish()
    .transform((v) => v ?? null),
});

export const correctionBody = z
  .object({
    /** Only HR may name someone else; staff always request for themselves. */
    staffId: z.uuid().optional(),
    workDate: isoDateSchema,
    requestedStatus: z.enum(REQUESTABLE_STATUSES).nullish(),
    requestedIn: instant.nullish(),
    requestedOut: instant.nullish(),
    reason: text(1000).min(3, 'Say what is wrong (at least 3 characters)'),
  })
  .refine((b) => b.requestedStatus || b.requestedIn || b.requestedOut, {
    path: ['requestedStatus'],
    message: 'Choose a status or give a check-in or check-out time',
  });

export const correctionDecisionBody = z
  .object({ decision: z.enum(['approved', 'rejected']), note: note() })
  .refine((b) => b.decision === 'approved' || (b.note?.length ?? 0) >= 3, {
    path: ['note'],
    message: 'Say why the request is rejected',
  });

export const correctionListQuery = z.object({
  status: z.enum(['pending', 'approved', 'rejected']).optional(),
  staffId: z.uuid().optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
});

export const importPreviewBody = z.object({
  filename: text(255).min(1),
  content: z.string().min(1).max(MAX_PUNCH_CSV_CHARS, 'The file is larger than 2 MB'),
});
