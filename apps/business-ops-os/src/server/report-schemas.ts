/** Request bodies: acknowledging Academic teacher reviews and reviewed student reports. */
import { z } from 'zod';
import { OPS_REPORT_AUDIENCES } from '@elevate/database';
import { isoDateSchema } from '@elevate/shared-contracts';
import { REPORT_SECTIONS } from '../domain/student-report';

const text = (max: number) => z.string().trim().max(max);
const optText = (max: number) => text(max).nullish();

/** Ops acknowledges one submitted review version and may add its own follow-up (never edits it). */
export const reviewAckBody = z
  .object({
    coreStudentId: z.uuid(),
    reviewKey: z.uuid(),
    version: z.coerce.number().int().min(1),
    note: optText(2000),
    followUp: optText(2000),
    followUpOn: isoDateSchema.nullish(),
  })
  .strict()
  .refine((b) => !b.followUpOn || b.followUp, {
    error: 'Describe the follow-up that is due on this date.',
    path: ['followUp'],
  });

export const reportBody = z
  .object({
    from: isoDateSchema,
    to: isoDateSchema,
    audience: z.enum(OPS_REPORT_AUDIENCES).default('internal'),
    /**
     * Optional subset (admin dossier; a guardian/student fee statement must be asked for), as a
     * list or as form checkboxes `{ results: true, fees: false, … }`.
     */
    sections: z
      .union([
        z.array(z.enum(REPORT_SECTIONS)).max(REPORT_SECTIONS.length),
        z
          .partialRecord(z.enum(REPORT_SECTIONS), z.boolean())
          .transform((r) => REPORT_SECTIONS.filter((k) => r[k])),
      ])
      .optional(),
    acknowledgement: z.boolean().default(false),
    /** Written by a person, perhaps from an AI draft (D-111); printed as "Overall comment". */
    comment: optText(2000),
  })
  .strict()
  .refine((b) => b.from <= b.to, { error: 'The start must be on or before the end', path: ['to'] });

export const reportStatusBody = z.object({ to: z.enum(['reviewed', 'final']) }).strict();
