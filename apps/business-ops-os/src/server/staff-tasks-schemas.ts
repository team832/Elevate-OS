/**
 * zod schemas for daily tasks (owner decision 21 Oct 2026).
 */
import { z } from 'zod';
import { isoDateSchema } from '@elevate/shared-contracts';
import { istToday } from '../domain/dates';
import { TASK_PRIORITIES, TASK_RECURRENCES, TASK_STATUSES } from '../domain/staff-tasks';
import { TASK_ACTIONS, type TaskAction } from '../domain/task-lifecycle';

const text = (max: number) => z.string().trim().max(max);
const optText = (max: number) => text(max).nullish();
const optUuid = z.uuid().nullish();
/** IST time of day, `HH:MM`. */
const dueTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:00)?$/, 'Use a time like 14:30');

/** A form's `YYYY-MM-DDTHH:MM` is IST; a full ISO instant keeps its offset. */
const istDateTime = z.union([
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/)
    .transform((v) => new Date(`${v.slice(0, 16)}:00+05:30`)),
  z.iso.datetime({ offset: true }).transform((v) => new Date(v)),
]);
const expectedVersion = z.coerce.number().int().min(1);

const editable = {
  title: text(200).min(1, 'Required'),
  details: optText(2000),
  requesterStaffId: optUuid,
  requesterNote: optText(500),
  departmentId: optUuid,
  backupStaffId: optUuid,
  reviewerStaffId: optUuid,
  reviewRequired: z.boolean(),
  acceptanceCriteria: optText(2000),
  linkedRef: optText(200),
  plannedStartOn: isoDateSchema.nullish(),
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
    reviewRequired: editable.reviewRequired.default(false),
    /** Omitted: `manager` when assigning to someone else, else `self`. */
    source: z.enum(['manager', 'self', 'verbal', 'academic']).optional(),
    /** When the work came in (default now). */
    receivedAt: istDateTime.optional(),
    /** Who gave the work; only all scope may name someone (else the server records you). */
    assignedByStaffId: optUuid,
    /** Whose task; omitted = yours. Own scope may assign to direct and indirect reports (R3). */
    staffId: optUuid,
    leadId: optUuid,
    admissionId: optUuid,
    studentId: optUuid,
    /** Tasks this one waits on. */
    dependsOn: z.array(z.uuid()).max(20).optional(),
  })
  .refine((b) => [b.leadId, b.admissionId, b.studentId].filter(Boolean).length <= 1, {
    message: 'Link a task to one lead, admission or student at most.',
    path: ['studentId'],
  })
  .refine((b) => b.source !== 'verbal' || b.requesterStaffId || b.requesterNote, {
    message: 'Say who asked for it.',
    path: ['requesterNote'],
  });
export type TaskInput = z.output<typeof taskBody>;

export const taskPatch = z
  .object({
    ...z.object(editable).partial().shape,
    /** The version the editor saw; a newer one answers 409. */
    expectedVersion,
    /** Why the due date or priority changed (kept on the event). */
    changeReason: optText(500),
  })
  .strict()
  .refine(
    (b) => Object.keys(editable).some((k) => b[k as keyof typeof b] !== undefined),
    'Nothing to change.',
  );
export type TaskPatch = z.output<typeof taskPatch>;

/** Lifecycle action → URL slug (POST /staff-tasks/:id/<slug>). */
export const ACTION_SLUG: Record<TaskAction, string> = {
  acknowledge: 'acknowledge',
  clarify: 'request-clarification',
  start: 'start',
  block: 'block',
  hold: 'hold',
  resume: 'resume',
  submit: 'submit-for-review',
  approve: 'approve',
  request_changes: 'request-changes',
  complete: 'complete',
  cancel: 'cancel',
  reopen: 'reopen',
};
const SLUG_ACTION = new Map(TASK_ACTIONS.map((a) => [ACTION_SLUG[a], a]));
export const taskActionParams = z.object({
  id: z.uuid(),
  action: z
    .string()
    .refine((s) => SLUG_ACTION.has(s), 'Unknown task action')
    .transform((s) => SLUG_ACTION.get(s)!),
});
export const taskActionBody = z.object({ expectedVersion, reason: optText(1000) });
export type TaskActionBody = z.output<typeof taskActionBody>;
export const reassignBody = z.object({
  expectedVersion,
  toStaffId: z.uuid(),
  reason: optText(1000),
});
export const dependencyBody = z.object({ expectedVersion, dependsOnTaskId: z.uuid() });
export const taskReportQuery = z.object({ format: z.enum(['pdf', 'csv']).default('pdf') });

export const taskUpdateBody = z
  .object({
    /** IST work day; omitted = the start's day, else today. */
    occurredOn: isoDateSchema.optional(),
    workPerformed: text(2000).min(1, 'Required'),
    result: optText(2000),
    evidence: optText(500),
    remainingWork: optText(2000),
    blocker: optText(1000),
    nextStep: optText(1000),
    durationMinutes: z.coerce.number().int().min(1).max(1440).optional(),
    startedAt: istDateTime.optional(),
    endedAt: istDateTime.optional(),
    correctsUpdateId: optUuid,
    correctionReason: optText(500),
  })
  .refine((b) => !b.correctsUpdateId || b.correctionReason, {
    message: 'Say what was wrong.',
    path: ['correctionReason'],
  })
  .refine((b) => !b.endedAt || (b.startedAt && b.endedAt > b.startedAt), {
    message: 'End after the start.',
    path: ['endedAt'],
  })
  .refine((b) => !b.endedAt || b.endedAt <= new Date(), {
    message: 'The stop time cannot be in the future.',
    path: ['endedAt'],
  })
  .refine((b) => !(b.durationMinutes && b.endedAt), {
    message: 'Give the minutes or a start and stop time, not both.',
    path: ['durationMinutes'],
  })
  .refine((b) => !b.startedAt || !b.occurredOn || b.occurredOn === istToday(b.startedAt), {
    message: 'The work date is the IST day the work started.',
    path: ['occurredOn'],
  });
export type TaskUpdateInput = z.output<typeof taskUpdateBody>;

export const TASK_DUE_FILTERS = ['overdue', 'today', 'week'] as const;
export const taskListQuery = z.object({
  /** Words in the title. */
  q: text(100).optional(),
  staffId: z.uuid().optional(),
  departmentId: z.uuid().optional(),
  due: z.enum(TASK_DUE_FILTERS).optional(),
  /** `pending`: open tasks not yet acknowledged by their owner. */
  ack: z.literal('pending').optional(),
  status: z.enum(TASK_STATUSES).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
});
export type TaskListQuery = z.output<typeof taskListQuery>;
