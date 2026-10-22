/** Request schemas for marks entry and reports (A4). Marks are exact decimals checked against the scheme in the service. */
import { z } from 'zod';
import { isIsoDate } from '@elevate/shared-types';

const isoDate = z.string().refine((v) => Boolean(isIsoDate(v)), { error: 'Expected a calendar date in YYYY-MM-DD form' });

export const MARK_STATES = ['scored', 'absent', 'exempt', 'withheld', 'pending'] as const;

export const marksBody = z
  .object({
    marks: z
      .array(
        z
          .object({
            studentId: z.uuid(),
            state: z.enum(MARK_STATES),
            manualScore: z.union([z.string().trim().max(20), z.number()]).transform(String).optional(),
            /** The attempt version the marker opened (0 = no attempt yet); a mismatch is a conflict. */
            version: z.int().min(0),
          })
          .strict(),
      )
      .min(1)
      .max(2000),
  })
  .strict();

export const REPORT_KINDS = ['attendance', 'coverage', 'assessment', 'teacher-week'] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

export const reportParams = z.object({ kind: z.enum(REPORT_KINDS) });
export const reportQuery = z.object({
  batchId: z.uuid().optional(),
  assessmentId: z.uuid().optional(),
  staffId: z.uuid().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  format: z.enum(['json', 'csv']).optional(),
});
export type ReportQuery = z.output<typeof reportQuery>;
