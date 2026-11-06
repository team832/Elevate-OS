/** Request schemas for homework (F4-05). Dates are `YYYY-MM-DD` (Asia/Kolkata days). */
import { z } from 'zod';
import { ACADEMIC_HOMEWORK_STATUSES } from '@elevate/database';
import { isoDateSchema, optionalText, text } from './schemas';

const csv = { format: z.enum(['csv']).optional() };

/** List and completion filters: batch, and due dates from / to. */
export const homeworkQuery = z.object({
  batchId: z.uuid().optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  ...csv,
});
export const homeworkCsvQuery = z.object(csv);

export const createHomeworkBody = z
  .strictObject({
    batchId: z.uuid(),
    title: text(200),
    subjectId: z.uuid().optional(),
    chapterId: z.uuid().optional(),
    /** The teaching-log entry the homework was copied from. */
    classRecordId: z.uuid().optional(),
    setOn: isoDateSchema,
    dueOn: isoDateSchema,
    instructions: optionalText(4000),
    /** Coordinators only: the batch's teacher who set it (a teacher always sets their own). */
    teacherStaffId: z.uuid().optional(),
  })
  .refine((b) => b.dueOn >= b.setOn, { path: ['dueOn'], error: 'The due date cannot be before the set date.' });

/** Only the students sent change; a student left out stays as they were (unmarked stays unmarked). */
export const homeworkMarksBody = z.strictObject({
  marks: z
    .array(z.strictObject({ studentId: z.uuid(), status: z.enum(ACADEMIC_HOMEWORK_STATUSES), remark: optionalText(500) }))
    .min(1)
    .max(500)
    .refine((m) => new Set(m.map((r) => r.studentId)).size === m.length, { error: 'A student appears twice; nothing was saved.' }),
});

export const cancelHomeworkBody = z.strictObject({ reason: text(500) });
