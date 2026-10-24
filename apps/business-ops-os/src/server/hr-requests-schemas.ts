/** zod schemas for requests sent through HR (owner brief 23 Oct 2026 §6). */
import { z } from 'zod';
import {
  HR_QUEUE_TABS,
  HR_REQUEST_ACTIONS,
  HR_REQUEST_RELATED_KINDS,
  HR_REQUEST_URGENCIES,
} from '../domain/hr-requests';
import { taskBody } from './staff-tasks-schemas';

const text = (max: number) => z.string().trim().max(max);
const page = z.coerce.number().int().min(1).max(10_000).default(1);

/** Form value: `hr` (HR itself), `staff:<id>` or `key:<recipient key>` (setting hr.request_recipients). */
export const recipientValue = z
  .string()
  .regex(/^(hr|staff:[0-9a-f-]{36}|key:[a-z][a-z0-9_]{1,39})$/, 'Choose who the request is for.');

const fields = {
  category: text(40).min(1, 'Choose a category'),
  subject: text(200).min(1, 'Required'),
  message: text(5000),
  recipient: recipientValue,
  relatedKind: z.enum(HR_REQUEST_RELATED_KINDS),
  relatedId: z.uuid().nullish(),
  urgency: z.enum(HR_REQUEST_URGENCIES),
};
const related = (b: { relatedKind?: string; relatedId?: string | null }) =>
  b.relatedKind === undefined || (b.relatedKind === 'none') === !b.relatedId;
const RELATED = { message: 'Give the kind of record and its ID together.', path: ['relatedId'] };

/** Form picker value `task:<id>` (or `none`) → relatedKind + relatedId. */
const fromRef = (v: unknown) => {
  if (!v || typeof v !== 'object' || !('relatedRef' in v)) return v;
  const { relatedRef, ...rest } = v as { relatedRef: unknown };
  const [relatedKind, relatedId] = String(relatedRef).split(':');
  return { ...rest, relatedKind, relatedId };
};

export const hrRequestBody = z.preprocess(
  fromRef,
  z
    .object({
      ...fields,
      message: fields.message.default(''),
      recipient: fields.recipient.default('hr'),
      relatedKind: fields.relatedKind.default('none'),
      urgency: fields.urgency.default('normal'),
      /** true = keep it as a draft that HR does not see yet. */
      draft: z.boolean().default(false),
    })
    .refine(related, RELATED)
    .refine((b) => b.draft || b.message, { message: 'Write your message.', path: ['message'] }),
);
export type HrRequestInput = z.output<typeof hrRequestBody>;

export const hrRequestPatch = z
  .object(fields)
  .partial()
  .strict()
  .refine(related, RELATED)
  .refine((b) => Object.values(b).some((v) => v !== undefined), 'Nothing to change.');
export type HrRequestPatch = z.output<typeof hrRequestPatch>;

/** URL slug → action (`create-task` → `create_task`). */
export const hrActionParams = z.object({
  id: z.uuid(),
  action: z
    .string()
    .transform((s) => s.replace(/-/g, '_'))
    .pipe(z.enum(HR_REQUEST_ACTIONS)),
});

export const hrActionBody = z.object({
  /** What the recipient sees (forward), the reason (decline), the answer (respond, relay), HR's note (note). */
  body: text(5000).nullish(),
  /** HR's own note, never shown to the sender or the recipient. */
  hrNote: text(2000).nullish(),
  /** Forward: who HR routes it to; omitted = the intended recipient. */
  toStaffId: z.uuid().nullish(),
  /** Create a task: the task, as on the HR task form. */
  task: taskBody.optional(),
});
export type HrActionBody = z.output<typeof hrActionBody>;

export const hrRequestListQuery = z.object({
  view: z.enum(['mine', 'forwarded', 'queue']).default('mine'),
  tab: z.enum(HR_QUEUE_TABS.map((t) => t.key) as [string, ...string[]]).optional(),
  urgency: z.enum(HR_REQUEST_URGENCIES).optional(),
  category: text(40).optional(),
  q: text(100).optional(),
  page,
});
export type HrRequestListQuery = z.input<typeof hrRequestListQuery>;
