import { z } from 'zod';
import { isoDateSchema } from '@elevate/shared-contracts';
import { EOD_STATUSES } from '../domain/staff-tasks';
import { PERIOD_KINDS } from '../domain/work-report';

const optText = (max: number) => z.string().trim().max(max).nullish();
const required = (max: number) => z.string().trim().min(1, 'Required').max(max);

/** Build or refresh the draft for the day, week or month containing `reportDate`; narrative fields are saved when given. */
export const eodDraftBody = z.object({
  reportDate: isoDateSchema,
  periodKind: z.enum(PERIOD_KINDS).default('day'),
  summary: optText(4000),
  nextDayPlan: optText(4000),
  notes: optText(4000),
  /** The report `version` the editor loaded; a different stored version is refused (409). */
  version: z.coerce.number().int().min(1).optional(),
});
export type EodDraftInput = z.output<typeof eodDraftBody>;

/** Chosen recipient, only when the reporting manager cannot be resolved. */
export const eodSubmitBody = z.object({
  recipientStaffId: z.uuid().optional(),
  /** The report `version` the editor showed; a newer draft is refused (409). */
  expectedVersion: z.coerce.number().int().min(1).optional(),
});

export const EOD_REVIEW_ACTIONS = [
  'viewed',
  'comment',
  'clarification_requested',
  'revision_requested',
  'acknowledged',
] as const;
export const eodReviewBody = z
  .object({ kind: z.enum(EOD_REVIEW_ACTIONS), text: optText(4000) })
  .refine((b) => ['viewed', 'acknowledged'].includes(b.kind) || Boolean(b.text), {
    message: 'Write what you need.',
    path: ['text'],
  });
export type EodReviewInput = z.output<typeof eodReviewBody>;

export const eodFollowUpBody = z.object({
  title: required(200),
  details: optText(2000),
  dueOn: isoDateSchema.optional(),
});

export const eodVersionQuery = z.object({ version: z.coerce.number().int().min(1).optional() });

export const eodInboxQuery = z.object({
  /** Words in the employee's name. */
  q: z.string().trim().max(100).optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  staffId: z.uuid().optional(),
  departmentId: z.uuid().optional(),
  kind: z.enum(PERIOD_KINDS).optional(),
  status: z.enum(EOD_STATUSES).exclude(['draft']).optional(),
  blockers: z.enum(['1']).optional(),
  page: z.coerce.number().int().min(1).default(1),
});
export type EodInboxQuery = z.output<typeof eodInboxQuery>;

export const periodReportQuery = z
  .object({
    from: isoDateSchema,
    to: isoDateSchema,
    staffId: z.uuid().optional(),
    departmentId: z.uuid().optional(),
    format: z.enum(['json', 'csv', 'pdf']).default('json'),
  })
  .refine((q) => q.from <= q.to, {
    message: 'The start must be on or before the end.',
    path: ['to'],
  });

export const REPORT_STANDINGS = [
  'missing',
  'not_started',
  'not_expected',
  'no_schedule',
  'draft',
  'submitted',
  'revision_requested',
  'acknowledged',
] as const;
/** HR work-report list: one row per staff member for the period containing `date`. */
export const workReportListQuery = z.object({
  kind: z.enum(PERIOD_KINDS).default('week'),
  date: isoDateSchema.optional(),
  q: z.string().trim().max(100).optional(),
  departmentId: z.uuid().optional(),
  standing: z.enum(REPORT_STANDINGS).optional(),
  page: z.coerce.number().int().min(1).default(1),
});
export type WorkReportListQuery = z.output<typeof workReportListQuery>;
