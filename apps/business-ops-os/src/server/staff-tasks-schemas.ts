/**
 * zod schemas for daily tasks and end-of-day reports (owner decision 21 Oct 2026).
 */
import { z } from 'zod';
import { isoDateSchema } from '@elevate/shared-contracts';
import { TASK_PRIORITIES, TASK_RECURRENCES, TASK_STATUSES } from '../domain/staff-tasks';
import { MESSAGE_CHANNELS } from '../domain/appointments';

const text = (max: number) => z.string().trim().max(max);
const optText = (max: number) => text(max).nullish();
const optUuid = z.uuid().nullish();
/** IST time of day, `HH:MM`. */
const dueTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:00)?$/, 'Use a time like 14:30');

const editable = {
  title: text(200).min(1, 'Required'),
  details: optText(2000),
  assignedByStaffId: optUuid,
  priority: z.enum(TASK_PRIORITIES),
  dueOn: isoDateSchema,
  dueTime: dueTime.nullish(),
  status: z.enum(TASK_STATUSES),
  progressPercent: z.coerce.number().int().min(0).max(100),
  reason: optText(1000),
  recurrence: z.enum(TASK_RECURRENCES),
};

export const taskBody = z
  .object({
    ...editable,
    priority: editable.priority.default('medium'),
    /** Omitted: today (IST). */
    dueOn: isoDateSchema.optional(),
    status: editable.status.default('pending'),
    progressPercent: editable.progressPercent.default(0),
    recurrence: editable.recurrence.default('none'),
    /** Whose task; omitted = yours. Logging for someone else needs all-scope write. */
    staffId: optUuid,
    leadId: optUuid,
    admissionId: optUuid,
    studentId: optUuid,
  })
  .refine((b) => [b.leadId, b.admissionId, b.studentId].filter(Boolean).length <= 1, {
    message: 'Link a task to one lead, admission or student at most.',
    path: ['studentId'],
  });
export type TaskInput = z.output<typeof taskBody>;

export const taskPatch = z
  .object(editable)
  .partial()
  .refine((b) => Object.values(b).some((v) => v !== undefined), 'Nothing to change.');
export type TaskPatch = z.output<typeof taskPatch>;

export const taskListQuery = z.object({
  /** Words in the title. */
  q: text(100).optional(),
  staffId: z.uuid().optional(),
  status: z.enum(TASK_STATUSES).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
});
export type TaskListQuery = z.output<typeof taskListQuery>;

/** Build or refresh the draft for a day (and save the summary when given). */
export const eodDraftBody = z.object({
  reportDate: isoDateSchema,
  summary: optText(4000),
});
export const eodTeamQuery = z.object({ date: isoDateSchema.optional() });
export const eodShareBody = z.object({
  channel: z.enum(MESSAGE_CHANNELS).exclude(['sms']),
});
